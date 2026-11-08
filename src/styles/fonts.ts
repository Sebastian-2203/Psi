import { Caveat, Nunito_Sans, Playfair_Display } from 'next/font/google';

/** DESIGN_SYSTEM §4.3. Variable fonts, self-hosted by next/font. Mapped to --font-display/sans/hand in globals.css. */

export const playfair = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-playfair',
});

export const nunitoSans = Nunito_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-nunito',
});

/** Decorative only; rarely above the fold. */
export const caveat = Caveat({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-caveat',
  preload: false,
});

export const fontVariables = `${playfair.variable} ${nunitoSans.variable} ${caveat.variable}`;
