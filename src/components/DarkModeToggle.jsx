import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

function DarkModeToggle() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <button
      onClick={toggleDarkMode}
      className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 ring-1 ring-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:bg-secondary dark:ring-white/10 dark:focus:ring-offset-background"
      role="switch"
      aria-checked={isDarkMode}
      aria-label="Toggle dark mode"
    >
      <span className="sr-only">Toggle dark mode</span>
      <span
        className={`${
          isDarkMode ? 'translate-x-7' : 'translate-x-1'
        } inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow-lg transition-transform duration-200`}
      >
        {isDarkMode ? (
          <Moon className="h-3.5 w-3.5 text-black" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-yellow-500" />
        )}
      </span>
    </button>
  );
}

export default DarkModeToggle;
