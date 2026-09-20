import type { Metadata } from 'next';
import { Newsreader, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/**
 * Two voices, two typefaces.
 *
 * Newsreader carries speech — it is an editorial serif with real warmth, and a
 * transcript of a conversation should read like a script, not like UI. IBM Plex
 * Mono carries everything the machine says about itself: op traces, status,
 * timings. Keeping those two registers visually separate is most of the
 * hierarchy in this screen.
 */
const speech = Newsreader({
  variable: '--font-speech',
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
});

const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tutor — live blackboard',
  description: 'A physics teacher you can talk to, with a board it actually uses.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${speech.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
