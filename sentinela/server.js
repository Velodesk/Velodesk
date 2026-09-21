const path = require('path');
const express = require('express');
const dadosHandler = require('./api/dados.js');

const app = express();
const port = process.env.PORT || 8080;

app.get('/api/dados', (req, res) => dadosHandler(req, res));
app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Sentinela ouvindo na porta ${port}`);
});
