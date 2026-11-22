# Avaliação de Transferência Internacional — Cloudflare

- **Destinatário**: Cloudflare, Inc. (entidade contratante: validação externa)
- **Papel jurídico na operação**: Operador (proxy reverso da API)
- **País / Região de tratamento**: rede global; o TLS termina na borda mais próxima (normalmente no Brasil), mas não há garantia de roteamento só no Brasil
- **Acesso remoto de suporte em outros países?**: provável (EUA)
- **Finalidade específica**: proteção e entrega da API (DNS/proxy/HTTPS)
- **Categorias de dados transferidos**: todo o tráfego da API em claro na borda: eventos do SSW, check-ins (IMEI, localização), IPs dos coletores e administradores
- **Enquadramento no Art. 33 da LGPD**: **Art. 33, II, "b"**: Cláusulas-Padrão (Res. 19/2024, Anexo II)
- **Instrumento contratual associado**: DPA da Cloudflare (aceite a confirmar) + **adendo Anexo II** (pendente)
- **Transferências posteriores**: sub-operadores da Cloudflare (validação externa)
- **Medidas técnicas suplementares**: lotes do coletor assinados (HMAC), mas **não cifrados de ponta a ponta**: a borda vê o conteúdo. Opção avaliável: Cloudflare só como DNS, sem proxy, ou TLS de ponta a ponta até o Caddy
- **Transparência na Política de Privacidade**: pendente (L13): informar país de destino, finalidade, papel e direitos (Res. 19/2024, Art. 16)
- **Próxima revisão**: 2027-05-22 ou a cada mudança de plano/região
