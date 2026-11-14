// Worker poses. POSE10: on a call, phone at the right ear (chapter 3: the UE beside the head).
// POSE27: phone held in front of the chest (chapter 5: the device at the chest), AEGIS hold.
export const POSE10 = {
  clip: 'idle', ct: 3.0, height: 1.80,
  arm: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0], head: [0, 0, -6], neck: [0, 0, -4], spine2: [0, 0, 0],
  // phone pose (walker frame from the hips: right, forward, up; rot = pitch, yaw, roll): screen to the right cheek
  // the phone's back rests on the heel of the palm and the four finger pads (measured: no vertex inside the phone,
  // every finger within 1 mm of its back), and its screen just touches the ear
  hold: { pos: [0.109, 0.05, 0.60], rot: [0, -90, -55], pole: [0.5, 0.3, -1], twist: 0.5 },
  phoneOff: [-0.00265, 0.06367, 0.042], phoneRot: [10, -5, 0],
  fingers: { Index1: [33, 0, 0], Index2: [20, 0, 0], Index3: [10, 0, 0], Middle1: [32, 0, 0], Middle2: [18, 0, 0], Middle3: [9, 0, 0],
    Ring1: [20, 0, 0], Ring2: [2, 0, 0], Ring3: [1, 0, 0], Pinky1: [22, 0, 0], Pinky2: [5, 0, 0], Pinky3: [3, 0, 0] },
};
export const POSE27 = {
  clip: 'idle', ct: 3.0, height: 1.80,
  arm: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0], head: [8, 0, 0], neck: [7, 0, 0], spine2: [7, 0, 0],
  hold: { pos: [0.08, 0.32, 0.24], rot: [25, 20, 0], pole: [0.9, -0.2, -1], twist: 0.5, wrist: [0.11, 0.28, 0.23], ext: -8 },
  phoneOff: [0.03, 0.07, 0.024], phoneRot: [15, 0, -50],
  fingers: Object.fromEntries(['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [[`${f}1`, [55, 0, 0]], [`${f}2`, [80, 0, 0]], [`${f}3`, [40, 0, 0]]])),
};
