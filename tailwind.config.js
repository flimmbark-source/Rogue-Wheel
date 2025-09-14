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
        primary: '#84cc16',
        secondary: '#d946ef',
        surface: '#0f172a',
        panel: '#1e293b',
      },
      fontFamily: {
        heading: ['Poppins', 'sans-serif'],
        text: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
