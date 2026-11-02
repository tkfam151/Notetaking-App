export interface Template {
  id: string;
  name: string;
  category: 'Basic' | 'Personal' | 'Work' | 'School';
  /** Accent colour used for the gallery thumbnail */
  accent: string;
  title: string;
  html: string;
}

const today = () =>
  new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const task = (text: string, checked = false) =>
  `<li data-type="taskItem" data-checked="${checked}"><p>${text}</p></li>`;

export function getTemplates(): Template[] {
  return [
    {
      id: 'blank',
      name: 'Blank',
      category: 'Basic',
      accent: '#ffffff',
      title: 'Untitled document',
      html: '<p></p>',
    },
    {
      id: 'notes',
      name: 'Notes',
      category: 'Basic',
      accent: '#fab005',
      title: 'Notes',
      html: `
        <h1>Notes</h1>
        <p><span style="color: #868e96">${today()}</span></p>
        <h2>Key ideas</h2>
        <ul><li><p>Start writing your first idea here</p></li><li><p>Use <strong>Ctrl/⌘ + B</strong> for bold and <em>Ctrl/⌘ + I</em> for italics</p></li></ul>
        <h2>Details</h2>
        <p>Type <code>#</code> followed by a space at the start of a line to make a heading, <code>-</code> for a bullet list, or <code>[ ]</code> for a checklist.</p>
        <blockquote><p>Tip: everything saves automatically, even offline.</p></blockquote>`,
    },
    {
      id: 'todo',
      name: 'To-do list',
      category: 'Personal',
      accent: '#40c057',
      title: 'To-do list',
      html: `
        <h1>To-do list</h1>
        <p><span style="color: #868e96">Week of ${today()}</span></p>
        <h3>Today</h3>
        <ul data-type="taskList">${task('Reply to emails', true)}${task('Plan the week')}${task('Go for a walk')}</ul>
        <h3>This week</h3>
        <ul data-type="taskList">${task('Finish the report')}${task('Book appointment')}${task('Call family')}</ul>
        <h3>Someday</h3>
        <ul data-type="taskList">${task('Learn something new')}</ul>`,
    },
    {
      id: 'meeting',
      name: 'Meeting notes',
      category: 'Work',
      accent: '#228be6',
      title: 'Meeting notes',
      html: `
        <h1>Meeting notes</h1>
        <table><tbody>
          <tr><th><p>Date</p></th><td><p>${today()}</p></td></tr>
          <tr><th><p>Attendees</p></th><td><p>Name, Name, Name</p></td></tr>
          <tr><th><p>Facilitator</p></th><td><p>Name</p></td></tr>
        </tbody></table>
        <h2>Agenda</h2>
        <ol><li><p>Topic one</p></li><li><p>Topic two</p></li><li><p>Topic three</p></li></ol>
        <h2>Discussion</h2>
        <p>Summary of what was discussed…</p>
        <h2>Decisions</h2>
        <ul><li><p>Decision</p></li></ul>
        <h2>Action items</h2>
        <ul data-type="taskList">${task('Owner — task — due date')}${task('Owner — task — due date')}</ul>`,
    },
    {
      id: 'report',
      name: 'Report',
      category: 'Work',
      accent: '#364fc7',
      title: 'Project report',
      html: `
        <p style="text-align: center"><span style="font-family: Playfair Display; font-size: 28pt; color: #364fc7">Project Report</span></p>
        <p style="text-align: center"><span style="color: #868e96">Prepared by Your Name · ${today()}</span></p>
        <hr>
        <h1>Executive summary</h1>
        <p>Give a short overview of the project, the key findings, and what you recommend.</p>
        <h1>Background</h1>
        <p>Describe the problem or opportunity and why it matters.</p>
        <h1>Results</h1>
        <table><tbody>
          <tr><th><p>Metric</p></th><th><p>Target</p></th><th><p>Actual</p></th></tr>
          <tr><td><p>Metric A</p></td><td><p>100</p></td><td><p>112</p></td></tr>
          <tr><td><p>Metric B</p></td><td><p>50</p></td><td><p>47</p></td></tr>
        </tbody></table>
        <h1>Recommendations</h1>
        <ol><li><p>First recommendation</p></li><li><p>Second recommendation</p></li></ol>`,
    },
    {
      id: 'letter',
      name: 'Letter',
      category: 'Personal',
      accent: '#e64980',
      title: 'Letter',
      html: `
        <p><strong>Your Name</strong><br>123 Your Street<br>City, State 00000<br>you@example.com</p>
        <p>${today()}</p>
        <p>Recipient Name<br>Company<br>456 Their Street<br>City, State 00000</p>
        <p>Dear Recipient,</p>
        <p>Start your letter here. Introduce yourself and the reason you are writing.</p>
        <p>Use the following paragraphs to give more detail.</p>
        <p>Thank you for your time and consideration.</p>
        <p>Sincerely,</p>
        <p><br>Your Name</p>`,
    },
    {
      id: 'resume',
      name: 'Résumé',
      category: 'Work',
      accent: '#0b7285',
      title: 'Résumé',
      html: `
        <p><span style="font-family: Playfair Display; font-size: 30pt; color: #0b7285">Your Name</span></p>
        <p><span style="color: #495057">City, State · (555) 555-5555 · you@example.com · linkedin.com/in/you</span></p>
        <hr>
        <h2><span style="color: #0b7285">Summary</span></h2>
        <p>Two or three sentences about who you are and what you are great at.</p>
        <h2><span style="color: #0b7285">Experience</span></h2>
        <h3>Job Title — Company</h3>
        <p><span style="color: #868e96">2022 – Present</span></p>
        <ul><li><p>Accomplishment with a measurable result</p></li><li><p>Another accomplishment</p></li></ul>
        <h3>Job Title — Company</h3>
        <p><span style="color: #868e96">2019 – 2022</span></p>
        <ul><li><p>Accomplishment with a measurable result</p></li></ul>
        <h2><span style="color: #0b7285">Education</span></h2>
        <p><strong>Degree</strong>, School — Year</p>
        <h2><span style="color: #0b7285">Skills</span></h2>
        <p>Skill · Skill · Skill · Skill</p>`,
    },
    {
      id: 'essay',
      name: 'Essay',
      category: 'School',
      accent: '#7048e8',
      title: 'Essay',
      html: `
        <p><span style="font-family: Times New Roman">Your Name</span><br><span style="font-family: Times New Roman">Instructor</span><br><span style="font-family: Times New Roman">Course</span><br><span style="font-family: Times New Roman">${today()}</span></p>
        <p style="text-align: center"><span style="font-family: Times New Roman; font-size: 15pt"><strong>Essay Title</strong></span></p>
        <p style="line-height: 2"><span style="font-family: Times New Roman">Begin your introduction here. Hook the reader, give some context, and end with a clear thesis statement.</span></p>
        <p style="line-height: 2"><span style="font-family: Times New Roman">Each body paragraph should start with a topic sentence that supports your thesis, followed by evidence and analysis.</span></p>
        <p style="line-height: 2"><span style="font-family: Times New Roman">Conclude by restating your thesis in new words and summarising your main points.</span></p>`,
    },
    {
      id: 'journal',
      name: 'Journal',
      category: 'Personal',
      accent: '#f76707',
      title: 'Journal',
      html: `
        <p><span style="font-family: Lora; font-size: 24pt; color: #d9480f">${today()}</span></p>
        <p><span style="font-family: Lora"><em>How am I feeling today?</em></span></p>
        <p><span style="font-family: Lora">Write freely here…</span></p>
        <h3><span style="font-family: Lora">Three things I'm grateful for</span></h3>
        <ol><li><p></p></li><li><p></p></li><li><p></p></li></ol>
        <h3><span style="font-family: Lora">Tomorrow I want to…</span></h3>
        <p></p>`,
    },
    {
      id: 'lecture',
      name: 'Class notes',
      category: 'School',
      accent: '#12b886',
      title: 'Class notes',
      html: `
        <h1>Lecture title</h1>
        <p><span style="color: #868e96">Course · ${today()}</span></p>
        <table><tbody>
          <tr><th><p>Cues &amp; questions</p></th><th><p>Notes</p></th></tr>
          <tr><td><p>Key term?</p></td><td><p>Definition and explanation…</p></td></tr>
          <tr><td><p>Why does it matter?</p></td><td><p>Supporting details…</p></td></tr>
        </tbody></table>
        <h2>Summary</h2>
        <p>Summarise the lecture in your own words.</p>`,
    },
  ];
}
