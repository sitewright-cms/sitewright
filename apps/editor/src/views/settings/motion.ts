import type { Variants } from 'motion/react';

// Spring-driven enter/exit + stagger variants shared across the Settings surface.
// Wrap the surface in <MotionConfig reducedMotion="user"> so all transforms here
// automatically collapse to opacity-only when the user prefers reduced motion.

export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30, when: 'beforeChildren', staggerChildren: 0.05 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } },
};

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 26 } },
};

/** Springy hover-lift for the glass cards. */
export const cardHover = { y: -4, transition: { type: 'spring', stiffness: 400, damping: 18 } } as const;
