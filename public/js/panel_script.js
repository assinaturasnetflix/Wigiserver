document.getElementById('affiliate-form').addEventListener('submit', async function(event) {
    event.preventDefault(); // Impede o envio padrão do formulário

    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const responseMessageDiv = document.getElementById('response-message');

    // Desabilita o botão e mostra algum feedback de carregamento (opcional)
    submitButton.disabled = true;
    submitButton.textContent = 'Gerando...';
    responseMessageDiv.style.display = 'none'; // Esconde mensagens anteriores
    responseMessageDiv.className = ''; // Limpa classes CSS

    // Coleta os dados do formulário
    const formData = {
        mainAffiliateLink: form.mainAffiliateLink.value.trim(),
        button1Link: form.button1Link.value.trim(),
        button2Link: form.button2Link.value.trim(),
        button3Link: form.button3Link.value.trim(),
    };

    // Validação simples de campos vazios (embora o 'required' do HTML ajude)
    if (!formData.mainAffiliateLink || !formData.button1Link || !formData.button2Link || !formData.button3Link) {
        displayMessage('Por favor, preencha todos os links.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Gerar Minha Página';
        return; // Interrompe a execução
    }


    try {
        // Envia os dados para o backend
        const response = await fetch('/create-affiliate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Sucesso! Mostra a mensagem com o link
            displayMessage(`Página criada! Seu link público é: <a href="${result.publicUrl}" target="_blank">${result.publicUrl}</a>`, 'success');
            form.reset(); // Limpa o formulário após o sucesso
        } else {
            // Erro vindo do servidor
            displayMessage(result.message || 'Ocorreu um erro ao gerar a página.', 'error');
        }

    } catch (error) {
        // Erro de rede ou outro erro inesperado
        console.error('Erro no fetch:', error);
        displayMessage('Erro de conexão com o servidor. Tente novamente.', 'error');
    } finally {
        // Reabilita o botão, independentemente do resultado
        submitButton.disabled = false;
        submitButton.textContent = 'Gerar Minha Página';
    }
});

function displayMessage(message, type) {
    const responseMessageDiv = document.getElementById('response-message');
    responseMessageDiv.textContent = ''; // Limpa conteúdo anterior
     // Permite HTML na mensagem (cuidado com XSS se a mensagem viesse do usuário)
    responseMessageDiv.innerHTML = message;
    responseMessageDiv.className = type; // Adiciona classe 'success' or 'error'
    responseMessageDiv.style.display = 'block'; // Torna visível
    responseMessageDiv.style.opacity = 1;
}