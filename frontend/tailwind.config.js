/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F8FAFC',
          muted: '#F1F5F9',
        },
        border: {
          DEFAULT: '#E2E8F0',
          subtle: '#F1F5F9',
          strong: '#CBD5E1',
        },
        content: {
          primary: '#0F172A',
          secondary: '#334155',
          muted: '#64748B',
          faint: '#94A3B8',
        },
        brand: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          subtle: '#EFF6FF',
          border: '#BFDBFE',
        },
        // Discrete Operational Status (Clean, calm, professional)
        status: {
          info: { bg: '#F8FAFC', text: '#334155', border: '#CBD5E1' },
          notice: { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
          alert: { bg: '#FFF7ED', text: '#9A3412', border: '#FED7AA' },
          priority: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
          online: { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
          offline: { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'radar-sweep': 'radar 4s linear infinite',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        }
      }
    },
  },
  plugins: [],
}
