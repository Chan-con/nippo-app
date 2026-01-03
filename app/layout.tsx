import './globals.css';
import '../renderer/styles.css';
import type { Metadata, Viewport } from 'next';
import ViewportFix from './ViewportFix';

export const metadata: Metadata = {
  title: '日報管理アプリ',
  description: '日報管理アプリ (Next.js + Tailwind)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
      </head>
      <body>
        <ViewportFix />
        {children}
      </body>
    </html>
  );
}
