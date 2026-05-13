// Barrel re-export for all structural BOQ formula explainer functions.
// Each function signature: (state, key?) => { title, steps: [{ label, value, bold? }], note? }
// state = full Zustand store state (useStore.getState()).

export { explainColumnRCC, explainFootingRCC, explainFootingPCC, explainBeamRCC } from './columnFootingBeamFormulas'
export { explainSlabMain, explainSlabSunken, explainSunshades, explainParapet, explainStaircaseRCC } from './slabStaircaseFormulas'
export { explainSteelByElement, explainConcreteGrade } from './steelConcreteFormulas'
export { explainMasonryBeamDeduction } from './masonryDeductionFormulas'
