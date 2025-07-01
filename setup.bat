@echo off
chcp 65001 >nul
echo Nippo App Setup Starting...

echo.
echo 1. Installing Node.js dependencies...
call npm install

echo.
echo 2. Installing Python dependencies...
cd backend
pip install -r requirements.txt
cd ..

echo.
echo Setup completed successfully!
echo.
echo To start the app:
echo   npm start
echo.
echo To build:
echo   npm run build
echo.
pause