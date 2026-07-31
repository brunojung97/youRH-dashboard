/**
 * Gera hash bcrypt para uma senha — use para criar usuários.
 *
 * Uso: node scripts/hash-password.js minha-senha-aqui
 */
const bcrypt = require('bcryptjs');

const senha = process.argv[2];
if (!senha) {
  console.error('Uso: node scripts/hash-password.js <senha>');
  process.exit(1);
}

bcrypt.hash(senha, 10).then(hash => {
  console.log('\nHash gerado (cole no campo "password" do usuário):\n');
  console.log(hash);
  console.log('');
});
