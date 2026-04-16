const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { v7: uuidv7 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

mongoose.connect('mongodb+srv://solly:solly@cluster0.baqwblt.mongodb.net/?appName=Cluster0')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const profileSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true, unique: true },
  gender: String,
  gender_probability: Number,
  sample_size: Number,
  age: Number,
  age_group: String,
  country_id: String,
  country_probability: Number,
  created_at: { type: String, default: () => new Date().toISOString() }
});

const Profile = mongoose.model('Profile', profileSchema);


function getAgeGroup(age) {
  if (age <= 12) return 'child';
  if (age <= 19) return 'teenager';
  if (age <= 59) return 'adult';
  return 'senior';
}

function formatProfile(profile) {
  const obj = profile.toObject({ versionKey: false });
  delete obj._id;
  return obj;
}

async function classifyName(name) {
  const [genderRes, ageRes, nationRes] = await Promise.all([
    fetch(`https://api.genderize.io/?name=${encodeURIComponent(name)}`).then(r => r.json()),
    fetch(`https://api.agify.io/?name=${encodeURIComponent(name)}`).then(r => r.json()),
    fetch(`https://api.nationalize.io/?name=${encodeURIComponent(name)}`).then(r => r.json())
  ]);

  if (!genderRes.gender || genderRes.count === 0) {
    throw { code: 502, message: 'Genderize returned an invalid response' };
  }
  if (ageRes.age === null) {
    throw { code: 502, message: 'Agify returned an invalid response' };
  }
  if (!nationRes.country || nationRes.country.length === 0) {
    throw { code: 502, message: 'Nationalize returned an invalid response' };
  }

  const bestCountry = nationRes.country.reduce((prev, curr) =>
    curr.probability > prev.probability ? curr : prev
  );

  return {
    gender: genderRes.gender,
    gender_probability: genderRes.probability,
    sample_size: genderRes.count,
    age: ageRes.age,
    age_group: getAgeGroup(ageRes.age),
    country_id: bestCountry.country_id,
    country_probability: parseFloat(bestCountry.probability.toFixed(4))
  };
}


app.post('/api/profiles', async (req, res) => {
  const { name } = req.body;

  if (!name || (typeof name === 'string' && name.trim() === '')) {
    return res.status(400).json({ status: 'error', message: 'Name is required and cannot be empty' });
  }

  if (typeof name !== 'string') {
    return res.status(422).json({ status: 'error', message: 'Name must be a string' });
  }

  const trimmedName = name.trim().toLowerCase();

  try {

    let existing = await Profile.findOne({ name: trimmedName });
    if (existing) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: formatProfile(existing)
      });
    }

    const classified = await classifyName(trimmedName);

    const newProfile = new Profile({
      id: uuidv7(),
      name: trimmedName,
      ...classified
    });

    await newProfile.save();

    res.status(201).json({
      status: 'success',
      data: formatProfile(newProfile)
    });

  } catch (error) {
    if (error.code === 502) {
      return res.status(502).json({ status: '502', message: error.message });
    }
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/profiles', async (req, res) => {
  try {
    let query = {};

    if (req.query.gender) query.gender = req.query.gender.toLowerCase();
    if (req.query.country_id) query.country_id = req.query.country_id.toUpperCase();
    if (req.query.age_group) query.age_group = req.query.age_group.toLowerCase();

    const profiles = await Profile.find(query).lean();

    const data = profiles.map(p => ({
      id: p.id,
      name: p.name,
      gender: p.gender,
      age: p.age,
      age_group: p.age_group,
      country_id: p.country_id
    }));

    res.json({
      status: 'success',
      count: data.length,
      data
    });
  } catch (error) {
    console.error("GET /api/profiles Error:", error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.get('/api/profiles/:id', async (req, res) => {
  try {
    const profile = await Profile.findOne({ id: req.params.id }).select('-_id -__v');

    if (!profile) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }
    res.json({ status: 'success', data: profile });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const result = await Profile.findOneAndDelete({ id: req.params.id });
    if (!result) {
      return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});