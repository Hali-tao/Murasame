import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/pet.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#20222B',
        'ink-soft': '#31343F',
        paper: '#F4F1EB',
        card: '#FFFFFF',
        'card-alt': '#F9F7F2',
        line: '#E6E0D6',
        'line-soft': '#EFEAE1',
        text: '#252730',
        muted: '#7B7D86',
        faint: '#A6A5A5',
        coral: '#E36F61',
        'coral-dark': '#C9584D',
        'coral-soft': '#FBEDE9',
        green: '#398D72',
        'green-soft': '#E8F4EF',
        amber: '#B97A26',
        'amber-soft': '#FBF1DF',
        blue: '#4E73A8',
        'blue-soft': '#EAF0F8',
        violet: '#7B6FA8',
        'violet-soft': '#F0EDF8',
        red: '#BC514D',
        'red-soft': '#FBEAE8'
      },
      fontFamily: {
        sans: ['Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', 'sans-serif'],
        mono: ['Cascadia Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        soft: '0 14px 36px rgba(28, 29, 36, 0.08)',
        dialog: '0 24px 70px rgba(18, 19, 24, 0.22)'
      },
      borderRadius: {
        xl2: '18px'
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-6px) scale(1.012)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' }
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        breathe: 'breathe 4.5s ease-in-out infinite',
        float: 'float 5.5s ease-in-out infinite',
        toastIn: 'toastIn 180ms ease-out'
      }
    }
  },
  plugins: []
} satisfies Config
