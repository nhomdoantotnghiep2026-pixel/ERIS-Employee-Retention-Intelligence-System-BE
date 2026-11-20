const {AppError}=require('../errors/app-error');
const shiftTypeKey=value=>typeof value==='string'?value.normalize('NFKC').trim().toUpperCase():null;
function normalizeShiftType(value){
 const normalized=shiftTypeKey(value);
 if(!normalized||!/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(normalized))throw new AppError(400,'shift_type is required: 1–50 letters, digits, underscores or hyphens, starting with a letter or digit.');
 return normalized;
}
module.exports={normalizeShiftType,shiftTypeKey};
