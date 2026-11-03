const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'oficina_db',
  password: 'senaisp',
  port: 5432,
});


pool.connect((err, client, release) => {
  if (err) {
    return console.error(' Erro ao ligar à base de dados PostgreSQL:', err.stack);
  }
  console.log(' Ligação à base de dados PostgreSQL estabelecida com sucesso!');
  release();
});

module.exports = pool;