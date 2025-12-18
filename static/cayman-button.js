(function () {
  const script = document.currentScript || document.querySelector('script[data-site]');
  if (!script) return;

  const siteKey = script.getAttribute('data-site');
  const apiBase = (script.getAttribute('data-api') || window.location.origin).replace(/\/$/, '');

  if (!siteKey) {
    console.warn('[cayman-button] data-site is required');
    return;
  }

  const buttons = Array.from(document.querySelectorAll('[data-cayman-product]'));
  if (!buttons.length) {
    return;
  }

  const promptFor = (label, preset) => {
    if (preset && preset.trim().length > 0) {
      return preset.trim();
    }
    return window.prompt(label) || '';
  };

  const buildPayload = (button) => {
    const productId = button.getAttribute('data-cayman-product');
    const qty = button.getAttribute('data-qty') || '1';
    const email = promptFor('Email address', button.getAttribute('data-email'));
    const firstName = promptFor('First name', button.getAttribute('data-first-name'));
    const lastName = promptFor('Last name', button.getAttribute('data-last-name'));

    return {
      siteKey,
      productId,
      qty: Number.parseInt(qty, 10) || 1,
      customer: {
        email,
        firstName,
        lastName
      }
    };
  };

  const handleClick = async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    const payload = buildPayload(button);

    if (!payload.productId || !payload.customer.email || !payload.customer.firstName || !payload.customer.lastName) {
      window.alert('Missing required checkout details.');
      return;
    }

    try {
      button.setAttribute('disabled', 'true');

      const response = await fetch(`${apiBase}/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 201) {
        const data = await response.json();
        if (data && typeof data.redirectUrl === 'string') {
          window.location.href = data.redirectUrl;
          return;
        }
      }

      const error = await response.json().catch(() => ({}));
      window.alert(error?.error || 'Unable to start Cayman checkout.');
    } catch (err) {
      console.error('[cayman-button] failed to create session', err);
      window.alert('Unable to start Cayman checkout.');
    } finally {
      button.removeAttribute('disabled');
    }
  };

  buttons.forEach((button) => {
    button.addEventListener('click', handleClick);
  });
})();
