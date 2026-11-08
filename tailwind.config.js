/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        spectra: {
          black: "#1e1e1e",
          white: "#e8e4d9",
          red: "#9e2a1f",
          yellow: "#d9b82c",
          green: "#2d6a3e",
          blue: "#25467a",
        },
      },
    },
  },
  plugins: [],
};
