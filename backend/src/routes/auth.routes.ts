/** auth.routes v1.5.1 — display name só via aliasColaborador ou colaboradorNome */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { signToken } from '../middleware/auth';
import { isFuncionariosConnected, isMongoConnected } from '../config/database';
import { verifyGoogleIdToken } from '../services/googleAuth.service';
import {
  evaluateColaboradorDeskAccess,
  resolveDeskAccessFromCadastro,
} from '../services/deskCadastroAccess.service';
import {
  findColaboradorAuthByEmail,
  verifyColaboradorPassword,
  resolveColaboradorDisplayName,
} from '../services/colaboradoresCadastro.service';
import { env } from '../config/env';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ message: 'Banco de dados indisponível. Aguarde o backend conectar ao MongoDB.' });
    }
    if (!isFuncionariosConnected()) {
      return res.status(503).json({
        message: 'Cadastro de colaboradores indisponível. Aguarde a conexão com o VeloHubCentral.',
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email e senha são obrigatórios' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const colaboradorAuth = await findColaboradorAuthByEmail(normalizedEmail);
    if (!colaboradorAuth || !verifyColaboradorPassword(colaboradorAuth, password)) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }

    const access = evaluateColaboradorDeskAccess(colaboradorAuth);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.reason });
    }

    const name = resolveColaboradorDisplayName(access.colaborador);

    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      const hash = await bcrypt.hash(`cadastro-desk:${normalizedEmail}`, 10);
      user = await User.create({
        name,
        email: normalizedEmail,
        password: hash,
      });
    } else if (name && user.name !== name) {
      user.name = name;
      await user.save();
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: access.role,
      name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        name,
        email: user.email,
        role: access.role,
        deskProfile: access.deskProfile,
        source: 'cadastro-desk',
      },
      colaborador: access.colaborador,
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ message: 'Erro no login' });
  }
});

router.post('/auth/google', async (req: Request, res: Response) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ message: 'Banco de dados indisponível. Aguarde o backend conectar ao MongoDB.' });
    }
    if (!isFuncionariosConnected()) {
      return res.status(503).json({
        message: 'Cadastro de colaboradores indisponível. Aguarde a conexão com o VeloHubCentral.',
      });
    }

    const clientId = env.googleClientId;
    if (!clientId) {
      return res.status(503).json({ message: 'GOOGLE_CLIENT_ID não configurado no backend.' });
    }

    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
      return res.status(400).json({ message: 'Credencial Google é obrigatória' });
    }

    const googleUser = await verifyGoogleIdToken(credential, clientId);
    const access = await resolveDeskAccessFromCadastro(googleUser.email);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.reason });
    }

    const name = resolveColaboradorDisplayName(access.colaborador);

    let user = await User.findOne({ email: googleUser.email });
    if (!user) {
      const hash = await bcrypt.hash(`google-sso:${googleUser.email}`, 10);
      user = await User.create({
        name,
        email: googleUser.email,
        password: hash,
      });
    } else if (name && user.name !== name) {
      user.name = name;
      await user.save();
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: access.role,
      name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        name,
        email: user.email,
        role: access.role,
        deskProfile: access.deskProfile,
        picture: googleUser.picture || access.colaborador.profile_pic || null,
        source: 'google-desk',
      },
      colaborador: access.colaborador,
    });
  } catch (err) {
    console.error('Erro no login Google:', err);
    const message = err instanceof Error ? err.message : 'Erro no login Google';
    res.status(401).json({ message });
  }
});

/** Login provisório desativado — use Google SSO com acessos.Desk no cadastro. */
router.post('/auth/dev-login', (_req: Request, res: Response) => {
  return res.status(404).json({
    message: 'Login de desenvolvimento desativado. Use o login Google com acessos.Desk no cadastro.',
  });
});

export default router;
