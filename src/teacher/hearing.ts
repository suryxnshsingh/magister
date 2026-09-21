/**
 * What the student's speech is transcribed as.
 *
 * The transcriber auto-detects language unless told otherwise, and on a short
 * sound that is not speech — a chair, a breath, a cough — it guesses. Its
 * favourite guess was Spanish: the student's turns kept arriving as "¿Qué?".
 * That is not only a wrong line in the transcript. The transcript is how a
 * nod is told from a question, and a Spanish line in the model's context is a
 * pull toward answering in Spanish.
 *
 * Measured on gemini-3.8-live with the same clips, 350ms of noise:
 *   auto-detect           "¿Qué?"  (2/2, v1beta and v1alpha)
 *   hi-IN, en-IN hinted   ""       (2/2, v1beta)   "I" (1/1, v1alpha)
 * A spoken Hinglish question and a "hmm" were transcribed identically either
 * way, so the hint costs nothing on real speech.
 *
 * Hindi and English only, matching the teacher: those are the languages this
 * lesson happens in.
 */
export const STUDENT_LANGUAGES = ['hi-IN', 'en-IN'];

/** Terms the transcriber should expect, so a student's physics is heard as physics. */
export const PHYSICS_VOCABULARY = [
  'velocity', 'acceleration', 'displacement', 'projectile', 'momentum', 'friction',
  'normal force', 'free body diagram', 'angular velocity', 'torque', 'inertia',
  'refraction', 'reflection', 'interference', 'diffraction', 'fringe', 'fringe width',
  'path difference', "Young's double slit", 'wavelength', 'focal length', 'lens formula',
  'mirror formula', 'convex', 'concave', 'magnification', 'capacitance', 'resistance',
  'current', 'potential difference', 'electric field', 'magnetic field', 'entropy',
  'thermodynamics', 'work done', 'kinetic energy', 'potential energy', 'simple harmonic motion',
];
