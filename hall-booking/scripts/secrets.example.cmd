@echo off
rem Connector secrets for the local setup. Copy this file to secrets.cmd (git-ignored) and change the values.
rem start-camunda.cmd passes them to the connectors runtime, where BPMN reads them as {{secrets.NAME}};
rem start-mail.cmd uses the same SMTP user and password for the local mail server, so they always match.
rem Nothing secret is stored in the BPMN files or in git.
set "SMTP_HOST=127.0.0.1"
set "SMTP_PORT=1025"
set "SMTP_USERNAME=hall-booking"
set "SMTP_PASSWORD=change-me"
set "MAIL_FROM=hall-booking@college.edu"
