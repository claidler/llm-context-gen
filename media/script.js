// media/script.js
(function () {
    const vscode = acquireVsCodeApi();
    const promptInput = document.getElementById('promptInput');
    const input = document.getElementById('pathInput');
    const dropdown = document.getElementById('dropdown');
    const copyButton = document.getElementById('copyButton');
    const selectedFilesContainer = document.getElementById('selectedFiles');

    let files = [];
    let filteredFiles = [];
    let activeIndex = -1;
    let selectedFiles = [];

    // Function to fetch the list of files from the extension
    function fetchFileList() {
        vscode.postMessage({ command: 'requestFileList' });
    }

    // Function to render the dropdown
    function renderDropdown() {
        if (filteredFiles.length === 0) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            return;
        }

        dropdown.innerHTML = '';
        filteredFiles.forEach((file, index) => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.dataset.index = index;

            const fileNameSpan = document.createElement('span');
            fileNameSpan.textContent = file;

            div.appendChild(fileNameSpan);

            div.addEventListener('click', () => {
                selectFile(file);
                dropdown.classList.add('hidden');
                dropdown.innerHTML = '';
                activeIndex = -1;
            });
            dropdown.appendChild(div);
        });

        dropdown.classList.remove('hidden');
        dropdown.style.width = `100%`;
    }

    // Function to select a file
    function selectFile(file) {
        if (!selectedFiles.includes(file)) {
            selectedFiles.push(file);
            renderSelectedFiles();
            insertPathAtCursor(file);
        }
        // Clear the input box after inserting the path
        input.value = '';
        filteredFiles = [];
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        activeIndex = -1;
    }

    // Function to remove a selected file
    function removeFile(file) {
        selectedFiles = selectedFiles.filter(f => f !== file);
        renderSelectedFiles();
    }

    // Function to render selected files
    function renderSelectedFiles() {
        selectedFilesContainer.innerHTML = '';
        selectedFiles.forEach(file => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'selected-file';

            const fileName = document.createElement('span');
            fileName.textContent = file;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => {
                removeFile(file);
            });

            fileDiv.appendChild(fileName);
            fileDiv.appendChild(removeBtn);
            selectedFilesContainer.appendChild(fileDiv);
        });
    }

    // Function to insert the selected path into the input
    function insertPathAtCursor(path) {
        const cursorPos = input.selectionStart;
        const value = input.value;
        const atIndex = value.lastIndexOf('@', cursorPos - 1);
        if (atIndex !== -1) {
            const newValue = value.substring(0, atIndex) + path + value.substring(cursorPos);
            input.value = newValue;
            // Move cursor after the inserted path
            const newCursorPos = atIndex + path.length;
            input.setSelectionRange(newCursorPos, newCursorPos);
        } else {
            // If '@' not found, append the path
            input.value += path;
        }
    }

    // Function to handle copying context
    function copyContext() {
        const prompt = promptInput.value.trim();
        if (selectedFiles.length === 0) {
            vscode.postMessage({ command: 'showError', message: 'No files selected to copy context.' });
            return;
        }
        vscode.postMessage({ command: 'copyContext', files: selectedFiles, prompt: prompt });
    }

    // Function to show notifications
    function showNotification(message, isError = false) {
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }
        notification.textContent = message;
        notification.style.backgroundColor = isError ? '#ff4c4c' : '#323232';
        notification.classList.add('show');
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000); // Notification visible for 3 seconds
    }

    // Event listener for keyup to detect changes in the input
    input.addEventListener('keyup', function (event) {
        const value = input.value;
        const cursorPos = input.selectionStart;
        const lastChar = value[cursorPos - 1];

        if (lastChar === '@') {
            // User typed '@', fetch and show file list
            fetchFileList();
        } else {
            // Filter files based on input
            const atIndex = value.lastIndexOf('@', cursorPos - 1);
            if (atIndex !== -1) {
                const query = value.substring(atIndex + 1, cursorPos).toLowerCase();
                filteredFiles = files.filter(file => file.toLowerCase().includes(query));
                activeIndex = -1; // Reset active index
                renderDropdown();
            } else {
                dropdown.classList.add('hidden');
                dropdown.innerHTML = '';
                activeIndex = -1;
            }
        }
    });

    // Event listener for keydown to handle navigation and selection
    input.addEventListener('keydown', function (event) {
        if (dropdown.classList.contains('hidden')) {
            return;
        }

        const items = dropdown.querySelectorAll('.dropdown-item');

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (activeIndex < items.length - 1) {
                activeIndex += 1;
            } else {
                activeIndex = 0;
            }
            updateActiveItem(items);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (activeIndex > 0) {
                activeIndex -= 1;
            } else {
                activeIndex = items.length - 1;
            }
            updateActiveItem(items);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeIndex >= 0 && activeIndex < items.length) {
                const selectedFile = items[activeIndex].textContent;
                selectFile(selectedFile);
                dropdown.classList.add('hidden');
                dropdown.innerHTML = '';
                activeIndex = -1;
            }
        } else if (event.key === 'Escape') {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            activeIndex = -1;
        }
    });

    // Function to update the active (highlighted) item
    function updateActiveItem(items) {
        items.forEach((item, index) => {
            if (index === activeIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    // Event listener to close the dropdown when clicking outside
    document.addEventListener('click', function (event) {
        if (!input.contains(event.target) && !dropdown.contains(event.target) && !promptInput.contains(event.target)) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            activeIndex = -1;
        }
    });

    // Event listener for the copy button
    copyButton.addEventListener('click', function () {
        copyContext();
    });

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data; // The JSON data our extension sent
        switch (message.command) {
            case 'fileList':
                files = message.files;
                filteredFiles = files;
                renderDropdown();
                break;
            case 'showError':
                // alert(message.message);
                showNotification(message.message, true);
                break;
            case 'copySuccess':
                // alert('File contexts copied to clipboard successfully!');
                showNotification('File contexts copied to clipboard successfully!');
                break;
            case 'copyError':
                // alert('Failed to copy file contexts to clipboard.');
                showNotification('Failed to copy file contexts to clipboard.', true);
                break;
        }
    });
}());
