import React from 'react';
import { Route, Routes } from 'react-router-dom';
import LegadoOctaSelectPage from './LegadoOctaSelectPage';
import LegadoOctaListPage from './LegadoOctaListPage';
import LegadoOctaDetailPage from './LegadoOctaDetailPage';
import LegadoOctaWhatsappListPage from './LegadoOctaWhatsappListPage';
import LegadoOctaWhatsappDetailPage from './LegadoOctaWhatsappDetailPage';

export default function LegadoOctaRouter() {
  return (
    <Routes>
      <Route index element={<LegadoOctaSelectPage />} />
      <Route path="tickets" element={<LegadoOctaListPage />} />
      <Route path="tickets/ticket/:number" element={<LegadoOctaDetailPage />} />
      <Route path="whatsapp" element={<LegadoOctaWhatsappListPage />} />
      <Route path="whatsapp/:id" element={<LegadoOctaWhatsappDetailPage />} />
    </Routes>
  );
}
