# Firebase → Supabase Migration Guide
## Royalty Real Estate Dashboard

This document walks you through completing the migration end-to-end.

---

## Prerequisites

- Node.js 18+
- A Supabase account (free tier is fine): [supabase.com](https://supabase.com)
- Access to your Firebase project console

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name, password, and region closest to your users
3. Wait for the project to provision (~2 minutes)

---

## Step 2 — Run the SQL Schema

1. In your Supabase Dashboard, go to **SQL Editor** → **New query**
2. Open the file `supabase/schema.sql` from this project
3. Paste the entire contents and click **Run**
4. Verify all tables appear in **Table Editor**

---

## Step 3 — Configure Your Credentials

Edit `assets/js/supabase-config.js` and replace the placeholder values:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGci...YOUR-ANON-KEY';
```

Find these values in: **Supabase Dashboard → Project Settings → API**

---

## Step 4 — Deploy Edge Functions

### Install Supabase CLI (if not already installed)
```powershell
npm install -g supabase
```

### Login and link your project
```powershell
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

### Deploy both Edge Functions
```powershell
supabase functions deploy create-user
supabase functions deploy send-whatsapp
```

### Set secrets for WhatsApp
```powershell
supabase secrets set WHATSAPP_ACCESS_TOKEN=your_token_here
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your_phone_id_here
```

### Update the WhatsApp endpoint in whatsapp.js
Edit `assets/js/whatsapp.js` line 4:
```js
const ENDPOINT = "https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-whatsapp";
```

---

## Step 5 — Export Firestore Data

### Install script dependencies
```powershell
cd scripts
npm install
```

### Download Firebase service account key
1. Firebase Console → Project Settings → Service accounts
2. Click **Generate new private key**
3. Save as `scripts/serviceAccountKey.json`

### Run the export
```powershell
node export-firestore.js
```

This creates `scripts/exported-data/` with JSON files for all collections.

---

## Step 6 — Import Data into Supabase

### Create the `.env` file in the `scripts/` directory
```
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...YOUR-SERVICE-ROLE-KEY
```

> ⚠️ The **service role key** is different from the anon key. Find it in:
> Supabase Dashboard → Project Settings → API → **service_role** key
> Never expose this in client-side code.

### Run the import
```powershell
node import-to-supabase.js
```

The script will:
1. Create Supabase Auth accounts for all Firebase users
2. Import all profiles, properties, messages, attachments, logs, etc.
3. Save a UID mapping file at `exported-data/uid-map.json`

> ⚠️ **Password Reset Required**: All migrated users are assigned a temporary password:
> `Royalty@2025!ChangeMe`
>
> Each user should log in and immediately change their password via:
> **Settings → Change Password**

### Run the Media Migration (Optional - to move Cloudinary files to Supabase Storage)
If you want to download all existing images/files from Cloudinary and upload them to your new Supabase Storage buckets, run:
```powershell
node migrate-media-to-supabase.js
```
This will automatically:
1. Scan your properties, attachments, and deed documents for external URLs.
2. Download them and upload them into your `land-images` and `deed-images` Supabase Storage buckets.
3. Update your database records to point to the new Supabase Storage locations.

---

## Step 7 — Create Your First Admin User

If you need to create an `admin_owner` user from scratch:

1. Go to **Supabase Dashboard → Authentication → Users → Add user**
2. Enter email as: `yourusername@royalty.local`
3. Set a password
4. Then in **SQL Editor**, run:

```sql
UPDATE public.profiles
SET role = 'admin_owner', name = 'Your Name'
WHERE id = (SELECT id FROM auth.users WHERE email = 'yourusername@royalty.local');
```

---

## Step 8 — Test End-to-End

Open your site and verify:

- [ ] Login page works (`login.html`)
- [ ] Dashboard loads after login
- [ ] Correct username/role shown in sidebar
- [ ] Properties list loads (`properties.html`)
- [ ] Map shows properties with coordinates (`map.html`)
- [ ] Can create/edit/delete a property
- [ ] Messages work (send and receive)
- [ ] Users page shows all users (admin only)
- [ ] Settings → Change Password works
- [ ] Logout redirects to login

---

## Step 9 — Remove Firebase (Optional Cleanup)

Once you've confirmed everything works:

1. Delete these files (already removed from the codebase):
   - `assets/js/firebase-config.js`
   - `firestore.rules`
   - `firestore.indexes.json`

2. In `firebase.json`, you can remove the `firestore` configuration if you're keeping Firebase Hosting.

3. In the Firebase Console, you can disable Firestore and Authentication if no longer needed.

---

---

## Supabase Storage Setup

The application is fully integrated with Supabase Storage for all file uploads. You must create the following buckets:

1. **`land-images`**
   - Click **Create bucket** in the Supabase Dashboard -> Storage
   - Name it: `land-images`
   - Toggle **Public bucket** to **ON** (allows public read access for property photos)
   - Save the bucket

2. **`deed-images`**
   - Click **Create bucket**
   - Name it: `deed-images`
   - Leave **Public bucket** as **OFF** (private bucket for sensitive attachments/deeds)
   - Save the bucket

3. **Enable RLS Policies**
   - Paste and run the Storage RLS section of `supabase/schema.sql` in the SQL Editor to restrict upload/delete operations to authorized users.

---

## Environment Variables Summary

| Variable | Where Used | Where to Find |
|----------|-----------|---------------|
| `SUPABASE_URL` | `assets/js/supabase-config.js` | Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | `assets/js/supabase-config.js` | Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/.env` only | Dashboard → Settings → API |
| `WHATSAPP_ACCESS_TOKEN` | Supabase secret (Edge Function) | Meta Business Dashboard |
| `WHATSAPP_PHONE_NUMBER_ID` | Supabase secret (Edge Function) | Meta Business Dashboard |

---

## Troubleshooting

### "Invalid API key" error
→ Check `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `supabase-config.js`

### Users can't log in after migration
→ Remind them to use their username only (not the email), and the temporary password `Royalty@2025!ChangeMe`

### Dashboard shows "فشل الاتصال بقاعدة البيانات" (Database connection error)
→ Check that the SQL schema was run and RLS policies are enabled

### Properties not showing on map
→ Ensure properties have `coordinates` field with `{ lat, lng }` — check in Supabase Table Editor

### Edge Functions not deploying
→ Make sure you've run `supabase link --project-ref YOUR-REF` first

### `create-user` function returns 403
→ The calling user must have `role = 'admin_owner'` in the `profiles` table
