// Lógica para Compartir Player
document.addEventListener('DOMContentLoaded', () => {
    const shareBtn = document.getElementById('shareBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShare = document.getElementById('closeShare');
    const copyLink = document.getElementById('copyLink');
    const shareMessage = document.getElementById('shareMessage');

    const shareData = {
        title: 'Radio Espectacular',
        text: '¡Escucha Radio Espectacular en vivo! La mejor música las 24 horas.',
        url: window.location.href
    };

    shareBtn.addEventListener('click', async () => {
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                console.log('Compartido con éxito');
            } catch (err) {
                console.log('Error al compartir:', err);
                openModal();
            }
        } else {
            openModal();
        }
    });

    function openModal() {
        shareModal.style.display = 'flex';
    }

    closeShare.addEventListener('click', () => {
        shareModal.style.display = 'none';
    });

    copyLink.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            shareMessage.style.display = 'block';
            setTimeout(() => {
                shareMessage.style.display = 'none';
            }, 2000);
        });
    });

    // Cerrar al hacer clic fuera
    window.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.style.display = 'none';
        }
    });
});
