// Supabase Edge Function: create-user
// Deno runtime — deployed via: supabase functions deploy create-user
//
// Creates a new Supabase Auth user without affecting the admin's session.
// The admin's JWT (Bearer token) is required in the Authorization header.
// The service role key is used server-side to call admin.createUser().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the caller is an authenticated admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the caller's JWT using the anon client
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check that the caller has admin_owner or manager role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role, disabled')
      .eq('id', caller.id)
      .single();

    if (!callerProfile || callerProfile.disabled || !['admin_owner', 'admin'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const body = await req.json();
    const { action, uid, email, password, role = 'viewer', name, username, phone } = body;

    // Handle Delete User action
    if (action === 'delete') {
      if (!uid) {
        return new Response(JSON.stringify({ error: 'uid is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (uid === caller.id) {
        return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Delete user from Auth (Cascade deletes the profile from public.profiles table)
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);
      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create the auth user using service role (does NOT sign in the caller)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,  // skip email verification for internal staff accounts
      user_metadata: { role: role || 'viewer' },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUid = newUser.user.id;

    // Upsert the profile row (the trigger may have already created a stub)
    await adminClient.from('profiles').upsert({
      id: newUid,
      email,
      username: username || null,
      name: name || null,
      phone: phone || null,
      role: role || 'viewer',
      disabled: false,
      is_setup_complete: false, // force user to do first-login setup flow
      created_at: Date.now(),
    }, { onConflict: 'id' });

    return new Response(JSON.stringify({ uid: newUid, email }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
