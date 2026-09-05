# Drop-in 3D assets

Put a GLB here named `store.glb` and it is loaded on top of the procedural store
(`tryLoadExternalModel` in `assets/js/store/scene.js`). Nothing else needs changing —
if the file is absent the app carries on without it.

Useful sources:

- Hugging Face Hub, filtered to 3D assets — https://huggingface.co/models?other=3d
- Khronos glTF sample assets — https://github.com/KhronosGroup/glTF-Sample-Assets
- Poly Haven / Sketchfab CC0 supermarket kits

Scale matters: the store is modelled in metres, 26 m wide by 20 m deep, eye height 1.62 m.
Scale or offset the model inside `tryLoadExternalModel` if it arrives in centimetres.
