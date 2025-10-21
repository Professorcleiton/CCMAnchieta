document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contactForm');
    const formMessage = document.getElementById('formMessage');

    form.addEventListener('submit', (event) => {
        event.preventDefault(); // Previne o envio do formulário

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const message = document.getElementById('message').value;

        // Exemplo simples de validação
        if (name && email && message) {
            formMessage.textContent = 'Obrigado pelo seu contato, ' + name + '!';
            formMessage.style.color = 'green';
            form.reset(); // Limpa o formulário
        } else {
            formMessage.textContent = 'Por favor, preencha todos os campos.';
            formMessage.style.color = 'red';
        }
    });
});
document.addEventListener('DOMContentLoaded', () => {
    const chatbox = document.getElementById('chatbox');
    const openChatButton = document.getElementById('open-chat');
    const closeChatButton = document.getElementById('close-chat');
    const chatInput = document.getElementById('chat-input');
    const sendMessageButton = document.getElementById('send-message');
    const chatLog = document.getElementById('chat-log');

    openChatButton.addEventListener('click', () => {
        chatbox.style.display = 'block';
        openChatButton.style.display = 'none';
    });

    closeChatButton.addEventListener('click', () => {
        chatbox.style.display = 'none';
        openChatButton.style.display = 'block';
    });

    sendMessageButton.addEventListener('click', () => {
        sendMessage();
    });

    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    async function sendMessage() {
        const message = chatInput.value.trim();
        if (message) {
            chatLog.innerHTML += `<div><strong>Você:</strong> ${message}</div>`;
            chatInput.value = '';

            // Send the message to the backend
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });

                const data = await response.json();
                const botMessage = data.message;
                chatLog.innerHTML += `<div><strong>Assistente:</strong> ${botMessage}</div>`;
                chatLog.scrollTop = chatLog.scrollHeight;
            } catch (error) {
                console.error('Error:', error);
                chatLog.innerHTML += `<div><strong>Assistente:</strong> Ocorreu um erro. Tente novamente mais tarde.</div>`;
            }
        }
    }
});
document.body.style.overflow = 'auto'; // Certifique-se de que a rolagem está habilitada
function closeOverlay() {
    document.getElementById('overlay').style.display = 'none';
}
function abrirTelaCheia() {
    var video = document.getElementById("meuVideo");
    if (video.requestFullscreen) {
        video.requestFullscreen();
    } else if (video.mozRequestFullScreen) { // Firefox
        video.mozRequestFullScreen();
    } else if (video.webkitRequestFullscreen) { // Chrome, Safari and Opera
        video.webkitRequestFullscreen();
    } else if (video.msRequestFullscreen) { // IE/Edge
        video.msRequestFullscreen();
    }
}
document.addEventListener("scroll", function() {
    const backToTopButton = document.getElementById("back-to-top");
    if (window.scrollY > 100) {
        backToTopButton.classList.add("show");
    } else {
        backToTopButton.classList.remove("show");
    }
});

document.getElementById("back-to-top").addEventListener("click", function() {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
});
document.getElementById('loginForm').addEventListener('submit', function(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // Verifique as credenciais (aqui está um exemplo simples)
    if (username === 'admin' && password === '1234') {
        window.location.href = 'area-restrita.html';
    } else {
        alert('Usuário ou senha incorretos');
    }
});
function checkPassword() {
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    // Defina a senha correta aqui
    const correctPassword = '12345';

    if (password === correctPassword) {
        // Redireciona para a página restrita
        window.location.href = 'area-restrita.html';
    } else {
        errorMessage.textContent = 'Senha incorreta. Tente novamente.';
    }
}

window.sr = ScrollReveal({ reset: true });

sr.reveal('.sobre', { 
    rotate: { x:0, y:80, z:0},
    duration: 2000
});

sr.reveal('.equipe administrativa', { duration: 1000});

sr.reveal('.fique por dentro', { duration: 1000});

sr.reveal('.gallery', { duration: 1000});

sr.reveal('.contato', { duration: 1000});