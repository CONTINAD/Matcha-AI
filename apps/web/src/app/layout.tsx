import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Matcha AI - AI-Driven Crypto Trading',
  description: 'AI-driven crypto trading system powered by OpenAI and 0x',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

