@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "GIT="
for /f "delims=" %%i in ('where git 2^>nul') do set "GIT=%%i"
if not defined GIT for %%p in (
  "C:\Program Files\Git\cmd\git.exe"
  "C:\Program Files (x86)\Git\cmd\git.exe"
  "D:\Program Files\Git\cmd\git.exe"
  "D:\Program Files (x86)\Git\cmd\git.exe"
  "D:\program\Git\cmd\git.exe"
  "D:\Git\cmd\git.exe"
  "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
) do if exist %%p set "GIT=%%~p"
if not defined GIT (
  echo กำลังค้นหา git.exe ในไดรฟ์ D: รอสักครู่...
  for /f "delims=" %%i in ('dir /b /s "D:\git.exe" 2^>nul') do if not defined GIT set "GIT=%%i"
)
if not defined GIT (
  echo ไม่พบ Git ในเครื่อง ติดตั้งจาก https://git-scm.com/download/win แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b
)
echo ใช้ Git ที่: %GIT%
if not exist .git (
  "%GIT%" init
  "%GIT%" branch -M main
  "%GIT%" remote add origin https://github.com/kiatsakul2905/botrd-web.git
)
"%GIT%" add .
"%GIT%" commit -m "BOTRD web"
"%GIT%" push -u origin main
echo.
echo ถ้าบรรทัดท้ายมีคำว่า main -^> main แปลว่าโค้ดขึ้น GitHub แล้ว ไปขั้นตอน Neon/Google/Vercel ใน README ต่อได้เลย
pause