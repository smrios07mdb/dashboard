import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1280px',
      },
    },
    extend: {
      fontFamily: {
        // Default sans + the design's explicit type roles. Stacks (with
        // fallbacks) live in the CSS vars so a pairing tweak can swap them.
        sans: ['var(--font-ui)'],
        ui: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        /* ---- shadcn slots (HSL triplets → opacity-modifier aware) ---- */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        /* ---- design raw tokens (hex / rgba via var) ---- */
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        work: {
          DEFAULT: 'var(--work)',
          soft: 'var(--work-soft)',
        },
        personal: {
          DEFAULT: 'var(--personal)',
          soft: 'var(--personal-soft)',
        },
        'accent-soft': 'var(--accent-soft)',
        'accent-ink': 'var(--accent-ink)',
        'destructive-soft': 'var(--destructive-soft)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        offline: 'var(--offline)',
        jewel: {
          sapphire: 'var(--jewel-sapphire)',
          amethyst: 'var(--jewel-amethyst)',
          coral: 'var(--jewel-coral)',
          citron: 'var(--jewel-citron)',
          jade: 'var(--jewel-jade)',
          rose: 'var(--jewel-rose)',
          teal: 'var(--jewel-teal)',
          gold: 'var(--jewel-gold)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      letterSpacing: {
        label: '0.16em',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config
