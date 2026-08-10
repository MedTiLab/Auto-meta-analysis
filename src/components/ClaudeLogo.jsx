import React from 'react';

const ClaudeLogo = ({className = 'w-5 h-5'}) => {
  return (
    <img
      src="/icons/claude-ai-icon.svg"
      alt="Claude"
      className={className}
      loading="eager"
      decoding="sync"
      fetchpriority="high"
    />
  );
};

export default ClaudeLogo;
