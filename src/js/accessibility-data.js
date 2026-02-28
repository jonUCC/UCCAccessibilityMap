'use strict'

/*
  UCC Accessibility Seed Data
  ----------------------------
  Known hazards, steps, steep gradients, narrow paths, and surfaces
  around the UCC main campus.

  Each hazard is a small zone (circle) defined by a center point and radius.
  When a route passes through or near a hazard zone, it gets flagged.

  You can expand this data by walking the campus and adding entries.
  Eventually this could live in a database / API instead of a static file.
*/

const ACCESSIBILITY_HAZARDS = [
  // ---- Steps ----
  {
    id: 'steps-main-quad',
    type: 'steps',
    label: 'Steps at Main Quadrangle',
    lat: 51.8935,
    lng: -8.4918,
    radius: 15,          // meters – how close the route must pass to trigger
    severity: 'high',    // high = impassable for wheelchair, medium = difficult, low = caution
    affects: ['wheelchair', 'step-free'],
    note: 'Stone steps with no ramp alternative nearby'
  },
  {
    id: 'steps-west-wing',
    type: 'steps',
    label: 'Steps at West Wing entrance',
    lat: 51.8938,
    lng: -8.4935,
    radius: 12,
    severity: 'high',
    affects: ['wheelchair', 'step-free'],
    note: 'Use side entrance via Donovan\'s Road for step-free access'
  },
  {
    id: 'steps-boole-library',
    type: 'steps',
    label: 'Steps at Boole Library front',
    lat: 51.8932,
    lng: -8.4901,
    radius: 12,
    severity: 'high',
    affects: ['wheelchair', 'step-free'],
    note: 'Accessible entrance on ground floor at rear of building'
  },
  {
    id: 'steps-ORB',
    type: 'steps',
    label: 'Steps at O\'Rahilly Building',
    lat: 51.8939,
    lng: -8.4905,
    radius: 12,
    severity: 'high',
    affects: ['wheelchair', 'step-free'],
    note: 'Lift access available inside via corridor from Kane Building'
  },

  // ---- Steep gradients ----
  {
    id: 'steep-college-road',
    type: 'steep',
    label: 'Steep hill on College Road',
    lat: 51.8922,
    lng: -8.4935,
    radius: 25,
    severity: 'medium',
    affects: ['wheelchair', 'gentle-gradient', 'low-energy'],
    note: 'Gradient approx 8-10%. Tiring for manual wheelchair users'
  },
  {
    id: 'steep-gaol-walk',
    type: 'steep',
    label: 'Steep incline on Gaol Walk',
    lat: 51.8942,
    lng: -8.4880,
    radius: 20,
    severity: 'medium',
    affects: ['wheelchair', 'gentle-gradient', 'low-energy'],
    note: 'Steady incline heading north. Consider alternative via Western Road'
  },

  // ---- Poor surfaces ----
  {
    id: 'cobble-quad',
    type: 'surface',
    label: 'Cobblestones in Quad area',
    lat: 51.8936,
    lng: -8.4920,
    radius: 20,
    severity: 'medium',
    affects: ['wheelchair', 'step-free'],
    note: 'Uneven cobblestones, difficult for small wheels'
  },
  {
    id: 'gravel-presidents-garden',
    type: 'surface',
    label: 'Gravel path at President\'s Garden',
    lat: 51.8930,
    lng: -8.4930,
    radius: 15,
    severity: 'low',
    affects: ['wheelchair'],
    note: 'Loose gravel, passable but slow for wheelchairs'
  },

  // ---- Narrow paths ----
  {
    id: 'narrow-north-path',
    type: 'narrow',
    label: 'Narrow path behind Aula Maxima',
    lat: 51.8941,
    lng: -8.4925,
    radius: 15,
    severity: 'medium',
    affects: ['wheelchair'],
    note: 'Path narrows to ~90cm at pinch point'
  },

  // ---- No kerb drops ----
  {
    id: 'kerb-western-road',
    type: 'kerb',
    label: 'Missing kerb drop on Western Road crossing',
    lat: 51.8945,
    lng: -8.4910,
    radius: 10,
    severity: 'medium',
    affects: ['wheelchair', 'step-free'],
    note: 'No dropped kerb on south side of crossing'
  }
]

/*
  Accessibility profiles
  Each profile defines which hazard types matter and how they affect scoring.
  penalty: how many points to deduct per hazard (out of 100 starting score)
*/
const ACCESSIBILITY_PROFILES = {
  'step-free': {
    label: 'Step-free (wheelchair)',
    description: 'Avoids all steps, flags steep gradients and poor surfaces',
    penalties: {
      steps:   { high: 50, medium: 30, low: 15 },
      steep:   { high: 25, medium: 15, low: 5  },
      surface: { high: 20, medium: 10, low: 5  },
      narrow:  { high: 25, medium: 15, low: 5  },
      kerb:    { high: 20, medium: 10, low: 5  }
    }
  },
  'gentle-gradient': {
    label: 'Gentle gradient',
    description: 'Avoids steep hills and steps, suitable for crutches or pain/fatigue conditions',
    penalties: {
      steps:   { high: 40, medium: 25, low: 10 },
      steep:   { high: 35, medium: 20, low: 10 },
      surface: { high: 10, medium: 5,  low: 0  },
      narrow:  { high: 5,  medium: 0,  low: 0  },
      kerb:    { high: 15, medium: 10, low: 5  }
    }
  },
  'low-energy': {
    label: 'Low energy / fatigue',
    description: 'Prefers flat, short routes. Flags anything tiring',
    penalties: {
      steps:   { high: 30, medium: 20, low: 10 },
      steep:   { high: 30, medium: 20, low: 10 },
      surface: { high: 15, medium: 10, low: 5  },
      narrow:  { high: 5,  medium: 0,  low: 0  },
      kerb:    { high: 10, medium: 5,  low: 0  }
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.ACCESSIBILITY_HAZARDS = ACCESSIBILITY_HAZARDS
  window.ACCESSIBILITY_PROFILES = ACCESSIBILITY_PROFILES
}
