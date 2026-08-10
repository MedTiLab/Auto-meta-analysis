import React from 'react';

const BrandLogo = ({ className = 'h-8 w-24', alt = 'MedHelp logo', variant = 'default' }) => {
  const src = variant === 'transparent'
    ? '/icons/medhelp-logo-transparent.png'
    : '/icons/medhelp-logo.png';

  return (
    <img
      src={src}
      alt={alt}
      className={`${className} rounded-md object-contain object-center`}
      loading="eager"
      decoding="sync"
      fetchpriority="high"
    />
  );
};

export default BrandLogo;
