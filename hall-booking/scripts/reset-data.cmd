@echo off
rem Restores the 3 seed bookings in the booking register and clears the notifications log.
rem The backend must be running (start-backend.cmd). Run it before a demo or a test run.
"%SystemRoot%\System32\curl.exe" -s -X POST http://localhost:8090/api/demo/reset
echo.
