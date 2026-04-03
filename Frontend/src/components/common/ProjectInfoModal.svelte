<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{ close: void }>();
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" aria-label="Закрыть окно" on:click={() => dispatch('close')}></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="project-info-title">
    <div class="modal-header">
      <div>
        <h2 id="project-info-title">Безымянный гонец</h2>
        <p class="project-description">
          Что это такое? Это самописный (самонавайбкоденный) <strike>мессенджер</strike> гонец с защищённым сквозным шифрованием, сделанный на тот неприятный случай, если враги России в лице коварного Запада решат обрубить нам внешний доступ к их сервисам, а наши отечественные решения по тем или иным причинам станут недоступными к использованию.
        </p>
      </div>
      <button class="close-btn" type="button" on:click={() => dispatch('close')}>Закрыть</button>
    </div>

    <details class="faq-root">
      <summary>ЧаВо</summary>
      <div class="faq-list">
        <details class="faq-item">
          <summary>Есть же куча других существующих решений, зачем самописный?</summary>
          <div class="faq-body">
            <div>Во-первых, как любой уважающий себя программист, я обязан изобрести велосипед.</div>
            <div>Во-вторых, я также использую этот проект для сдачи лабораторной.</div>
            <div>В-третьих, почему бы и не попробовать вайбкодинг для чего-то большего чем просто питоновские скрипты.</div>
          </div>
        </details>

        <details class="faq-item">
          <summary>У меня браузер ругается, почему сертификаты самоподписанные?</summary>
          <div class="faq-body">
            <div>Это сделано специально по двум причинам:</div>
            <div> - Так проще.</div>
            <div> - На случай, если коварный Запад решит обрубить нам доступ к их центрам сертификации.</div>
          </div>
        </details>
        
        <details class="faq-item">
          <summary>А насколько это вообще безопасно?</summary>
          <div class="faq-body">
            <div>Поскольку на сервер вся информация посылается в зашифрованным вашим браузером виде, даже если коварный враг в лице ЦРУ и Моссада перехватит ваши сообщения или даже сворует базу данных, это не даст ему ничего (ну или им придётся потратить тыщу лет на взлом ключей, чтобы увидеть ваши картинки с котиками)</div>
          </div>
        </details>
        
        <details class="faq-item">
          <summary>Почему ограничение на файлы?</summary>
          <div class="faq-body">
            <div>Сервер не резиновый, всё же это сервис для обмена сообщениями, а не файлообменник.</div>
            <div>Да и почти всегда загружаемые файлы используются один раз либо переиспользуются. Для второго случая специально добавил переиспользование файлов чатов, а для первого - возможность удалить свои файлы, оставив маловесную заглушку.</div>
          </div>
        </details>
      </div>
    </details>
  </div>
</div>

<style>
  .modal-shell {
    position: fixed;
    inset: 0;
    z-index: 140;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(15, 23, 42, 0.48);
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 28px;
    border-radius: 20px;
    background: linear-gradient(180deg, #ffffff, #f8fafc);
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.22);
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 22px;
  }

  .modal-header h2 {
    margin: 0 0 8px;
    font-size: 28px;
    color: #0f172a;
  }

  .project-description {
    margin: 0;
    color: #475569;
    line-height: 1.5;
  }

  .close-btn {
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    background: #e2e8f0;
    color: #334155;
    cursor: pointer;
    font-weight: 600;
    flex: none;
  }

  .faq-root > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 2px 12px;
    color: #0f172a;
    font-size: 22px;
    font-weight: 700;
  }

  .faq-root > summary::-webkit-details-marker {
    display: none;
  }

  .faq-root > summary::before {
    content: '▸';
    color: #475569;
    font-size: 18px;
    line-height: 1;
    transform: translateY(1px);
    transition: transform 0.18s ease;
  }

  .faq-root[open] > summary::before {
    transform: rotate(90deg) translateX(1px);
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 8px;
  }

  .faq-item {
    border: 1px solid #dbe4ee;
    border-radius: 14px;
    background: white;
    overflow: hidden;
  }

  .faq-item summary {
    cursor: pointer;
    list-style: none;
    padding: 12px 14px;
    font-weight: 700;
    color: #0f172a;
  }

  .faq-item summary::-webkit-details-marker {
    display: none;
  }

  .faq-body {
    padding: 0 14px 14px;
    color: #475569;
    line-height: 1.5;
  }

  @media (max-width: 720px) {
    .modal {
      padding: 22px 18px;
    }

    .modal-header {
      flex-direction: column;
    }

    .close-btn {
      align-self: flex-end;
    }

    .faq-root > summary {
      font-size: 20px;
    }
  }
</style>
