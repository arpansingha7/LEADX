import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` LEADX Backend Server running on port ${PORT}`);
  console.log(` Frontend Dashboard served at http://localhost:${PORT}`);
  console.log(`==================================================`);
});
