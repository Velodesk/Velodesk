import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  createdAt: Date;
}

/**
 * Role NÃO é persistida aqui — sempre derivada de funcionarios_cadastroColaboradores
 * (VeloHub, fonte única) a cada login/requisição. Ver deskCadastroAccess.service.ts.
 */
const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
