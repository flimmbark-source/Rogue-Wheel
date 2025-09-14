/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#b68a4e',
        secondary: '#704921',
        surface: '#3b2610',
        panel: '#2c1c0e',
      },
      fontFamily: {
        heading: ['Poppins', 'sans-serif'],
        text: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
