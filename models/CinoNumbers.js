const mongoose = require('mongoose');

const cinoNumbersSchema = new mongoose.Schema(
  {
    cino: { type: String, required: true, unique: true, trim: true },
    numbers: { type: [String], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CinoNumbers', cinoNumbersSchema);