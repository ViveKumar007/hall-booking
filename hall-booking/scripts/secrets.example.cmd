@echo off
rem Local secrets. Copy this file to secrets.cmd (git-ignored) and fill in the values; nothing secret goes into git.
rem start-camunda.cmd passes them to the connectors runtime, where BPMN reads them as {{secrets.NAME}};
rem start-backend.cmd passes them to the Spring Boot backend; start-mail.cmd uses the SMTP login for the local mail server.

rem Mail: the local MailDev inbox (http://localhost:1080) by default; nothing leaves this computer.
set "SMTP_HOST=127.0.0.1"
set "SMTP_PORT=1025"
set "SMTP_USERNAME=hall-booking"
set "SMTP_PASSWORD=change-me"
set "MAIL_FROM=hall-booking@college.edu"
rem Encryption: NONE for MailDev; TLS for Gmail on port 587 (SSL for port 465).
set "SMTP_SECURITY=NONE"

rem Real email through Gmail instead of MailDev: turn on 2-Step Verification for the sending Gmail account, create an
rem App Password at https://myaccount.google.com/apppasswords, then replace the six mail lines above with these
rem (without "rem") and restart Camunda and the backend. The automated tests refuse to run while real mail is on.
rem set "SMTP_HOST=smtp.gmail.com"
rem set "SMTP_PORT=587"
rem set "SMTP_SECURITY=TLS"
rem set "SMTP_USERNAME=the.sender@gmail.com"
rem set "SMTP_PASSWORD=the 16-letter App Password, without the spaces"
rem set "MAIL_FROM=the.sender@gmail.com"

rem How long an approver has, and when the reminder goes out (ISO 8601: P1D = 1 day, PT1H = 1 hour). Default: 1 day
rem and a reminder after 1 hour. For a live demo of the reminder and the expiry, use 2 minutes and 1 minute:
rem set "APPROVAL_TIMEOUT=PT2M"
rem set "APPROVAL_REMINDER=PT1M"

rem Sign in with Google: OAuth client (Web application) from console.cloud.google.com, redirect URI
rem http://localhost:8090/login/oauth2/code/google
set "GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com"
set "GOOGLE_CLIENT_SECRET=your-client-secret"

rem Roles by Google account; anyone else who signs in is a requester. Format: email=role+role;email=role
rem Roles: admin, admin-office, dean, hod, lab-incharge
set "APP_ACCOUNTS=dean.person@gmail.com=dean+admin;office.person@gmail.com=admin-office+hod;lab.person@gmail.com=lab-incharge"

rem Shared key the REST connectors send to the booking register (any long random text)
set "REGISTER_API_KEY=change-me-to-a-long-random-text"

rem Address of the app, used in the links inside emails
set "APP_URL=http://localhost:8090"

rem Test-only login without Google, for automated tests. Never enable it on a shared machine.
rem set "APP_DEVLOGIN_ENABLED=true"
