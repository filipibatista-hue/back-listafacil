const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();

const JWT_SECRET = 'chave_secreta_super_segura_123';
const PORT = 3000;


app.use(cors());
app.use(express.json());

const autenticarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado.' });
    }
    req.user = user;
    next();
  });
};


const eAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' && req.user?.nivel !== 2) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
};



app.post(['/auth/cadastro', '/cadastro'], async (req, res) => {
  const nome = req.body.nome || req.body.email_usuario || req.body.email;
  const email = req.body.email || req.body.email_usuario;
  const senha = req.body.senha || req.body.senha_usuario;
  const role = req.body.role;

  if (!email || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }

  const emailTratado = String(email).trim().toLowerCase();
  const senhaTratada = String(senha).trim();

  try {
    const usuarioExiste = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(TRIM(email)) = $1',
      [emailTratado]
    );

    if (usuarioExiste.rows.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado.' });
    }

    const isExplicitAdmin = role === 'admin' || emailTratado.includes('admin@admin');
    const tipoUsuario = isExplicitAdmin ? 'admin' : 'user';

    const novoUsuario = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, role) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, role, created_at',
      [nome || emailTratado, emailTratado, senhaTratada, tipoUsuario]
    );

    res.status(201).json({
      mensagem: 'Usuário cadastrado com sucesso!',
      usuario: novoUsuario.rows[0],
    });
  } catch (error) {
    console.error('Erros no cadastro:', error);
    res.status(500).json({ error: 'Erro interno no servidor ao cadastrar.' });
  }
});

app.post(['/auth/login', '/login'], async (req, res) => {
  const emailInput = req.body.email || req.body.email_usuario;
  const senhaInput = req.body.senha || req.body.senha_usuario;

  if (!emailInput || !senhaInput) {
    return res.status(400).json({ error: 'Preencha e-mail e palavra-passe.' });
  }

  const emailTratado = String(emailInput).trim().toLowerCase();
  const senhaTratada = String(senhaInput).trim();

  const eAdminEmail = emailTratado === 'admin@admin' || emailTratado === 'admin@admin.com';

  if (eAdminEmail && senhaTratada === '12345678') {
    const token = jwt.sign(
      { id: 1, email: emailTratado, role: 'admin', nivel: 2 },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const dadosAdmin = {
      id: 1,
      id_user: 1,
      nome: 'Administrador',
      email: emailTratado,
      email_usuario: emailTratado,
      role: 'admin',
      nivel: 2,
      isAdmin: true,
      is_admin: true,
    };

    return res.json({
      token,
      ...dadosAdmin,
      usuario: dadosAdmin,
      user: dadosAdmin,
    });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(TRIM(email)) = $1',
      [emailTratado]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'E-mail ou palavra-passe inválidos.' });
    }

    const usuario = result.rows[0];

    if (usuario.senha.trim() !== senhaTratada) {
      return res.status(400).json({ error: 'E-mail ou palavra-passe inválidos.' });
    }

    const eAdminUser = (usuario.role === 'admin' || usuario.nivel === 2 || eAdminEmail);
    const role = eAdminUser ? 'admin' : 'user';
    const nivel = eAdminUser ? 2 : 1;

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, role, nivel },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const dadosUsuario = {
      ...usuario,
      role,
      nivel,
      isAdmin: eAdminUser,
      is_admin: eAdminUser,
    };

    res.json({
      token,
      ...dadosUsuario,
      usuario: dadosUsuario,
      user: dadosUsuario,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor ao realizar login.' });
  }
});

// ================= ROTA EXCLUSIVA DE ADMIN =================

app.get('/admin/dashboard', autenticarToken, eAdmin, async (req, res) => {
  try {
    const totalUsuarios = await pool.query('SELECT COUNT(*) FROM usuarios');
    const totalPosts = await pool.query('SELECT COUNT(*) FROM posts');
    const usuarios = await pool.query('SELECT id, nome, email, role, created_at FROM usuarios ORDER BY id DESC');

    res.json({
      metricas: {
        usuarios: parseInt(totalUsuarios.rows[0].count),
        tarefas: parseInt(totalPosts.rows[0].count),
        posts: parseInt(totalPosts.rows[0].count),
      },
      listaUsuarios: usuarios.rows,
    });
  } catch (error) {
    console.error('Erro no dashboard admin:', error);
    res.status(500).json({ error: 'Erro ao carregar dados administrativos.' });
  }
});

// ================= ROTAS DO CRUD (LISTAGEM, INSERÇÃO E EDIÇÃO COM STATUS) =================

// 1. Listar tarefas
// 1. Listar tarefas (Utilizador comum vê as suas + todas as criadas pelo Admin)
app.get(['/posts', '/produtos', '/tarefas'], autenticarToken, async (req, res) => {
  try {
    const eAdminUser = req.user?.role === 'admin' || req.user?.nivel === 2;

    let resultado;
    if (eAdminUser) {
      // Admin continua a ver tudo
      resultado = await pool.query(
        `SELECT p.id, p.titulo, p.texto, 
                COALESCE(p.status, 'pendente') AS status, 
                COALESCE(p.concluida, false) AS concluida,
                p.usuario_id, p.created_at, 
                COALESCE(u.nome, 'Administrador') AS autor_nome, 
                COALESCE(u.email, 'admin@admin.com') AS autor_email 
         FROM posts p 
         LEFT JOIN usuarios u ON p.usuario_id = u.id 
         ORDER BY p.id DESC`
      );
    } else {
      // Utilizador comum vê as DELE + TODAS as criadas pelo Admin (id = 1 ou role = 'admin')
      resultado = await pool.query(
        `SELECT p.id, p.titulo, p.texto, 
                COALESCE(p.status, 'pendente') AS status, 
                COALESCE(p.concluida, false) AS concluida,
                p.usuario_id, p.created_at, 
                COALESCE(u.nome, 'Administrador') AS autor_nome, 
                COALESCE(u.email, '') AS autor_email 
         FROM posts p 
         LEFT JOIN usuarios u ON p.usuario_id = u.id 
         WHERE p.usuario_id = $1 
            OR u.role = 'admin' 
            OR p.usuario_id = 1 
         ORDER BY p.id DESC`,
        [req.user.id]
      );
    }

    const tarefasFormatadas = resultado.rows.map(item => {
      const nomeAutor = item.autor_nome || 'Administrador';
      const emailAutor = item.autor_email || 'N/A';

      return {
        ...item,
        tarefa: item.titulo,
        descricao: item.texto,
        autor_nome: nomeAutor,
        autor_email: emailAutor,
        autor: nomeAutor,
        usuario: {
          id: item.usuario_id,
          nome: nomeAutor,
          email: emailAutor,
        }
      };
    });

    res.json(tarefasFormatadas);
  } catch (error) {
    console.error('Erro ao buscar itens:', error);
    res.status(500).json({ error: 'Erro ao carregar lista de tarefas.' });
  }
});

// 2. Criar nova tarefa
app.post(['/posts', '/produtos', '/tarefas'], autenticarToken, async (req, res) => {
  const titulo = req.body.titulo || req.body.tarefa || req.body.nome;
  const texto = req.body.texto || req.body.descricao || '';
  const status = req.body.status || (req.body.concluida ? 'concluido' : 'pendente');
  const concluida = status === 'concluido' || Boolean(req.body.concluida);
  const targetUsuarioId = req.body.usuario_id;

  if (!titulo) {
    return res.status(400).json({ error: 'O título/nome da tarefa é obrigatório.' });
  }

  const eAdminUser = req.user?.role === 'admin' || req.user?.nivel === 2;
  const donoId = (eAdminUser && targetUsuarioId) ? Number(targetUsuarioId) : req.user.id;

  try {
    const novoPost = await pool.query(
      'INSERT INTO posts (titulo, texto, status, concluida, usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [titulo, texto, status, concluida, donoId]
    );

    res.status(201).json(novoPost.rows[0]);
  } catch (error) {
    console.error('Erro ao criar tarefa:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa.' });
  }
});

// 3. Atualizar tarefa existente
app.put(['/posts/:id', '/produtos/:id', '/tarefas/:id'], autenticarToken, async (req, res) => {
  const { id } = req.params;
  const titulo = req.body.titulo || req.body.tarefa || req.body.nome;
  const texto = req.body.texto || req.body.descricao || '';
  const status = req.body.status || (req.body.concluida ? 'concluido' : 'pendente');
  const concluida = status === 'concluido' || Boolean(req.body.concluida);

  if (!titulo) {
    return res.status(400).json({ error: 'O título/nome da tarefa é obrigatório.' });
  }

  try {
    const postExistente = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (postExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }

    const eAdminUser = req.user?.role === 'admin' || req.user?.nivel === 2;
    const eDono = postExistente.rows[0].usuario_id === req.user.id;

    if (!eDono && !eAdminUser) {
      return res.status(403).json({ error: 'Não tem permissão para editar esta tarefa.' });
    }

    const postAtualizado = await pool.query(
      'UPDATE posts SET titulo = $1, texto = $2, status = $3, concluida = $4 WHERE id = $5 RETURNING *',
      [titulo, texto, status, concluida, id]
    );

    res.json(postAtualizado.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
  }
});

// 4. Excluir tarefa
app.delete(['/posts/:id', '/produtos/:id', '/tarefas/:id'], autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    const postExistente = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (postExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }

    const eAdminUser = req.user?.role === 'admin' || req.user?.nivel === 2;
    const eDono = postExistente.rows[0].usuario_id === req.user.id;

    if (!eDono && !eAdminUser) {
      return res.status(403).json({ error: 'Não tem permissão para eliminar esta tarefa.' });
    }

    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ mensagem: 'Tarefa removida com sucesso!' });
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error);
    res.status(500).json({ error: 'Erro ao eliminar tarefa.' });
  }
});

app.listen(PORT, () => {
  console.log(`Rodando na porta ${PORT}`);
});