const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // 'user_a', 'user_b'
    name: { type: String, required: true },
    label: { type: String, required: true },
  },
  { _id: false, timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
