# SendGrid inbound email setup

This document captures the configuration needed to enable inbound email ingestion for job openings.

## 1. Create or confirm the SendGrid account

1. Create a SendGrid account at https://sendgrid.com if needed.
2. On the free tier, verify the sender domain `linkup.tn` under Settings → Sender Authentication.
3. Keep the verification records and the generated DNS values so they can be reused later.

## 2. Configure the inbound subdomain in DNS

In Cloudflare, add the following MX record for the `mail` subdomain:

```text
Type: MX
Name: mail
Value: mx.sendgrid.net
Priority: 10
TTL: Auto
```

This ensures that inbound mail sent to addresses like `job-code@mail.linkup.tn` is routed to SendGrid.

## 3. Configure the SendGrid inbound webhook

In the SendGrid dashboard:

1. Open Settings → Inbound Parse.
2. Add a host named `mail.linkup.tn`.
3. Set the destination URL to the public API endpoint, for example:
   - `https://api.linkup.tn/api/v1/email/inbound`
   - or your temporary ngrok URL during development.
4. Keep the default parsed mode (do not enable raw MIME posting).
5. Leave "Send Raw" disabled.
6. Enable spam checks.

During local development, expose the backend with ngrok and use the temporary HTTPS URL as the webhook destination.

## 4. Environment variables

Add the following variables to the backend environment:

```env
SENDGRID_WEBHOOK_PUBLIC_KEY=
INBOUND_EMAIL_DOMAIN=mail.linkup.tn
```

The webhook public key comes from SendGrid Settings → Mail Settings → Event Webhook → Signature.

## 5. Backend expectations

The API now:

- generates a unique inbound email address per job opening,
- accepts inbound webhooks at `/api/v1/email/inbound`,
- validates attachments, rejects invalid files, and creates pending candidates for accepted attachments,
- stores ingestion logs for debugging and audit,
- sends an auto-reply to the sender based on the processing result.

## 6. Local testing checklist

1. Start the backend and expose it with ngrok.
2. Configure the SendGrid inbound host to point at the ngrok URL.
3. Send a test email with a PDF attachment to a generated job inbox address.
4. Confirm that a pending candidate is created and that the email is logged.
