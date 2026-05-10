/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd",
          300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9",
          600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e",
        },
      },
      keyframes: {
        // ConfirmDialog : backdrop fade + carte zoom-in
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "zoom-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "zoom-in": "zoom-in 150ms ease-out",
      },
    },
  },
  plugins: [],
};
