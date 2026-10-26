import type { Metadata } from 'next';
import { FeedbackProvider } from '../components/ui';
import './globals.css';

export const metadata: Metadata = { title: 'TowNow Operations', robots: { index: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
