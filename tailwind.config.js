/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50: 'rgb(240 247 255)',
          100: 'rgb(224 239 254)',
          200: 'rgb(186 224 253)',
          400: 'rgb(54 168 247)',
          500: 'rgb(12 138 235)',
          600: 'rgb(1 108 196)',
          700: 'rgb(1 85 155)',
          800: 'rgb(6 73 127)',
        },
        accent: {
          50: 'rgb(255 248 240)',
          100: 'rgb(255 239 217)',
          200: 'rgb(255 219 176)',
          400: 'rgb(255 154 56)',
          500: 'rgb(255 125 16)',
          600: 'rgb(240 95 0)',
          700: 'rgb(199 72 0)',
        },
        success: {
          50: 'rgb(240 253 244)',
          100: 'rgb(220 252 231)',
          200: 'rgb(187 247 208)',
          400: 'rgb(74 222 128)',
          500: 'rgb(34 197 94)',
          600: 'rgb(22 163 74)',
        },
        warning: {
          50: 'rgb(255 251 235)',
          100: 'rgb(254 243 199)',
          200: 'rgb(253 230 138)',
          600: 'rgb(217 119 6)',
          800: 'rgb(146 64 14)',
        },
        error: {
          50: 'rgb(254 242 242)',
          100: 'rgb(254 226 226)',
          200: 'rgb(254 202 202)',
          500: 'rgb(239 68 68)',
          600: 'rgb(220 38 38)',
        },
        purple: {
          50: 'rgb(250 245 255)',
          100: 'rgb(243 232 255)',
          600: 'rgb(126 34 206)',
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.2s ease-out',
        slideIn: 'slideIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
