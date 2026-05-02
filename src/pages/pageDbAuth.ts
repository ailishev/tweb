import Page from '@/pages/page';

const page = new Page('page-db-auth', true);

function createInput(type: string, placeholder: string) {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.classList.add('input-field-input');
  return input;
}

async function submit(path: string, body: any, status: HTMLElement) {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if(!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }

  localStorage.setItem('db_token', data.token);
  status.textContent = 'OK';
}

export default {
  mount: () => {
    page.mount();

    let container = page.pageEl?.querySelector('.container') as HTMLElement;
    if(!container) {
      const authPages = document.getElementById('auth-pages');
      const fallbackPage = document.createElement('div');
      fallbackPage.classList.add('tabs-tab', 'page-db-auth');

      container = document.createElement('div');
      container.classList.add('container', 'center-align');
      fallbackPage.append(container);

      const tabsContainer = authPages?.querySelector('.tabs-container');
      tabsContainer?.append(fallbackPage);
      (page as any).pageEl = fallbackPage;
    }

    container.replaceChildren();

    const title = document.createElement('h4');
    title.innerText = 'DB Auth';

    const email = createInput('email', 'Email');
    const phone = createInput('tel', 'Phone');
    const password = createInput('password', 'Password');
    const firstName = createInput('text', 'First Name');
    const lastName = createInput('text', 'Last Name');
    const status = document.createElement('div');

    const registerBtn = document.createElement('button');
    registerBtn.classList.add('btn-primary');
    registerBtn.innerText = 'Register';
    registerBtn.onclick = async() => {
      status.textContent = 'Loading...';
      try {
        await submit('register', {
          email: email.value || undefined,
          phone: phone.value || undefined,
          password: password.value,
          firstName: firstName.value || undefined,
          lastName: lastName.value || undefined
        }, status);
      } catch(err) {
        status.textContent = (err as Error).message;
      }
    };

    const loginBtn = document.createElement('button');
    loginBtn.classList.add('btn-primary');
    loginBtn.innerText = 'Login';
    loginBtn.onclick = async() => {
      status.textContent = 'Loading...';
      try {
        await submit('login', {
          email: email.value || undefined,
          phone: phone.value || undefined,
          password: password.value
        }, status);
      } catch(err) {
        status.textContent = (err as Error).message;
      }
    };

    container.append(title, email, phone, password, firstName, lastName, registerBtn, loginBtn, status);
    return Promise.resolve();
  }
};
