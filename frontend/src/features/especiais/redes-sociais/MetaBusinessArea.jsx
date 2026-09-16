/**
 * MetaBusinessArea — alterna entre a grade de cards e o painel de cada rede
 */
import React, { useState } from 'react';
import MetaBusinessCards from './MetaBusinessCards';
import FacebookPostsPanel from './FacebookPostsPanel';
import InstagramPostsPanel from './InstagramPostsPanel';
import PlayStoreReviewsPanel from './PlayStoreReviewsPanel';
import GestaoRedesSociaisPanel from './GestaoRedesSociaisPanel';

export default function MetaBusinessArea() {
  const [openChannel, setOpenChannel] = useState(null);

  if (openChannel === 'facebook') {
    return <FacebookPostsPanel onBack={() => setOpenChannel(null)} />;
  }

  if (openChannel === 'instagram') {
    return <InstagramPostsPanel onBack={() => setOpenChannel(null)} />;
  }

  if (openChannel === 'play-store') {
    return <PlayStoreReviewsPanel onBack={() => setOpenChannel(null)} />;
  }

  if (openChannel === 'gestao-redes') {
    return <GestaoRedesSociaisPanel onBack={() => setOpenChannel(null)} />;
  }

  return <MetaBusinessCards onSelect={setOpenChannel} />;
}
