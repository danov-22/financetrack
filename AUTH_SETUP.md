# Bewlet account setup

The repository now contains the public homepage and the first registration schema. No secret values are committed.

## 1. Create Supabase project

1. Create a Supabase project.
2. Open the SQL editor and run `supabase_schema.sql`.
3. In Authentication → Providers → Google, enable Google after completing step 2 below.
4. Copy the project URL and publishable key. Never use the secret/service key in browser code.

## 2. Configure Google login

1. Create a Google Cloud project.
2. Configure the Google Auth Platform branding and audience.
3. Create a Web application OAuth client.
4. Add these authorized origins:
   - `https://bewlet.vercel.app`
   - your local development origin, if needed
5. Add the Supabase callback URL shown on the Supabase Google provider page as an authorized redirect URI.
6. Paste the Google client ID and client secret into the Supabase Google provider settings.

Registration initially requests identity scopes only. Google Drive/Sheets authorization will be added as a separate step after the owner approves an account.

## 3. Configure Vercel

Add these project environment variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server-only; never expose through `public-config.js`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAIL`

Redeploy after adding the variables.

## 4. Bootstrap the owner account

1. Sign in once through the new homepage so an Auth user is created.
2. Run this once in the Supabase SQL editor, replacing the email:

```sql
insert into private.admin_users (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do nothing;
```

## Routes

- `/` — public homepage and Google registration (`index.html`)
- `/app?mode=demo` — isolated demo; never persists changes or syncs finance data
- `/app` — finance application served from `app.html` (route enforcement is added with the approval backend phase)

## Next implementation phase

- Private payment-proof upload UI
- Admin approval/rejection dashboard
- Atomic founder-license allocation
- Approval email notification
- Server-side route/session enforcement
- Post-approval Google Drive/Sheets authorization and automatic spreadsheet creation
